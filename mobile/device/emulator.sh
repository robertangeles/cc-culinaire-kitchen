#!/usr/bin/env bash
# The tablet emulator: a second test device beside the moto g86, with its own lease, serial and ports, so walks on the
# two never wait for each other. Android 15 x86_64 under KVM, headless, 1230 x 1770 px at 240 dpi = 820 x 1180 dp (iPad width).
# It lives on its own adb server (port 5038, held to this one device), so the phone's adb server (5037) never sees it and a
# bare `adb` in any phone walk still finds exactly one device.
#
#   bash device/emulator.sh start     cold-boot it (makes the AVD the first time), wait for boot; it stops itself after EMULATOR_IDLE_S idle
#   bash device/emulator.sh stop      stop it now (waits for the emulator lease, so never in the middle of someone's walk)
#   bash device/emulator.sh status
#   eval "$(bash device/emulator.sh env)"   then lease.sh, adb, the walks and buildStamp.sh use the emulator (device/README.md)
# The app on the emulator reaches this machine at 10.0.2.2 (the emulator's own alias for the host's 127.0.0.1), not through
# `adb reverse`, which connects to "localhost" on this machine and fails whenever that does not resolve to a working address.
#
# EMULATOR_IDLE_S     seconds with nobody holding the emulator lease before it stops itself (default 900)
# EMULATOR_BOOT_S     seconds to wait for boot before giving up and stopping it (default 300)
set -u
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/android-sdk}
ADB=$SDK/platform-tools/adb
AVD=culinaire-tablet
IMAGE="system-images;android-35;default;x86_64"
PORT=5600 # console port, above the 5554-5585 range the phone's adb server scans for emulators
SERIAL=emulator-$PORT
export ANDROID_ADB_SERVER_PORT=5038 # every adb call here, and the emulator's own registration, go to the emulator's server
RUN=${XDG_RUNTIME_DIR:-/tmp}
LOCK=$RUN/culinaire-emulator.lease
PIDFILE=$RUN/culinaire-emulator.pid
LOG=$RUN/culinaire-emulator.log
IDLE=${EMULATOR_IDLE_S:-900}
BOOT=${EMULATOR_BOOT_S:-300}

# The pid in the file, only if it is still our emulator (a pid can be reused by an unrelated process after a reboot).
our_pid() {
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null) || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q -- "-avd $AVD " && echo "$pid"
}
under_lease() { DEVICE_LEASE_FILE=$LOCK bash lease.sh "$@"; }

# The emulator's adb server stays up after stop: a later adb call with this port set would otherwise start a plain
# server, which takes USB devices too (the phone). One that did is replaced. Never call adb before it is listening.
adb_server() {
  if ss -ltn "sport = :$ANDROID_ADB_SERVER_PORT" | grep -q LISTEN; then
    "$ADB" devices | grep -v '^emulator-' | grep -q 'device$' || return 0
    "$ADB" kill-server
  fi
  "$ADB" start-server --one-device "$SERIAL" >/dev/null 2>&1
}
booted() { adb_server; [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; }

make_avd() {
  local cfg=$HOME/.android/avd/$AVD.avd/config.ini
  [ -f "$cfg" ] && return
  [ -d "$SDK/system-images/android-35/default/x86_64" ] || { echo "missing $IMAGE: $SDK/cmdline-tools/latest/bin/sdkmanager --install emulator '$IMAGE'" >&2; exit 1; }
  echo no | "$SDK/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" >/dev/null || exit 1
  for kv in hw.lcd.width=1230 hw.lcd.height=1770 hw.lcd.density=240 hw.ramSize=3072 hw.cpu.ncore=4 \
    hw.keyboard=no fastboot.forceColdBoot=yes; do
    sed -i "/^${kv%%=*}[ ]*=/d" "$cfg"
    echo "$kv" >>"$cfg"
  done
}

# Runs under the emulator lease (two workers starting it at once get one emulator).
start() {
  [ -n "$(our_pid)" ] && booted && { echo "running: $SERIAL"; return; }
  [ -r /dev/kvm ] && [ -w /dev/kvm ] || { echo "no read/write access to /dev/kvm: the emulator would be too slow to use" >&2; exit 1; }
  make_avd
  adb_server
  local t0=$SECONDS pid
  if ! pid=$(our_pid); then
    # setsid: its own process group, so stop can end the emulator and its helpers and nothing else.
    setsid "$SDK/emulator/emulator" -avd "$AVD" -port "$PORT" -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -memory 3072 \
      -gpu swiftshader_indirect </dev/null >"$LOG" 2>&1 &
    pid=$!
    echo "$pid" >"$PIDFILE"
  fi
  until booted; do
    if ! kill -0 "$pid" 2>/dev/null || [ $((SECONDS - t0)) -ge "$BOOT" ]; then
      echo "the emulator did not boot within ${BOOT}s; log: $LOG" >&2
      kill_it
      exit 1
    fi
    sleep 2
  done
  echo "booted $SERIAL in $((SECONDS - t0))s (pid $pid; stops after ${IDLE}s idle)"
  setsid bash emulator.sh _watch "$pid" </dev/null >>"$LOG" 2>&1 &
}

# Stops after IDLE seconds in which nobody held the emulator lease; ends by itself when the emulator it was started for is gone.
watch() {
  local idle=0
  while [ "$(our_pid)" = "$1" ]; do
    sleep 60
    if flock -n "$LOCK" true; then idle=$((idle + 60)); else idle=0; fi
    if [ "$idle" -ge "$IDLE" ]; then
      echo "idle for ${idle}s: stopping"
      DEVICE_LEASE_WAIT_S=0 under_lease bash emulator.sh _kill && exit 0
      idle=0
    fi
  done
}

kill_it() {
  local pid
  pid=$(our_pid) || { rm -f "$PIDFILE"; return 0; }
  adb_server
  "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -- "-$pid" 2>/dev/null
  rm -f "$PIDFILE"
  echo "stopped $SERIAL"
}

status() {
  local pid
  if ! pid=$(our_pid); then echo "stopped"; return 3; fi
  local rss
  rss=$(ps -o rss= -g "$pid" | awk '{s+=$1} END {printf "%d", s/1024}')
  echo "$SERIAL pid=$pid boot_completed=$(booted && echo yes || echo no) memory=${rss}MB lease=$(cat "$LOCK.holder" 2>/dev/null || echo free)"
}

case "${1:-}" in
  start) if [ -n "$(our_pid)" ] && booted; then echo "running: $SERIAL"; else under_lease bash emulator.sh _start; fi ;;
  stop) under_lease bash emulator.sh _kill ;;
  status) status ;;
  env) echo "export ANDROID_ADB_SERVER_PORT=$ANDROID_ADB_SERVER_PORT DEVICE_LEASE_FILE=$LOCK ANDROID_SERIAL=$SERIAL CULINAIRE_BUILD_STAMP=$HOME/.cache/culinaire-dev-build/emulator.fingerprint METRO_URL=http://10.0.2.2:8098 E2E_API_URL=http://127.0.0.1:3019 DEVICE_HOST_IP=10.0.2.2 SCREENS_DB=culinaire_screens_emulator" ;;
  _start) start ;;
  _watch) watch "$2" ;;
  _kill) kill_it ;;
  *) echo "usage: emulator.sh start|stop|status|env" >&2; exit 2 ;;
esac
