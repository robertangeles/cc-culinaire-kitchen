import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";
import { cardMotion } from "./motion";

/** Follows the phone's "reduce motion" setting, including when it is changed while the app is open. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Slides and fades the item card in when the item changes. Not on first show, and not at all with reduce motion. */
export function CardTransition({ itemKey, children }: { itemKey: string; children: ReactNode }) {
  const reduce = useReduceMotion();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const progress = useRef(new Animated.Value(1)).current;
  const shownKey = useRef<string | null>(null);

  // Layout effect, so the new card never paints once at rest before it starts to move. Keyed on the item only:
  // flipping the reduce-motion setting mid-use must not replay the slide on the same item.
  useLayoutEffect(() => {
    const first = shownKey.current === null;
    shownKey.current = itemKey;
    if (first) return;
    const { durationMs } = cardMotion(reduceRef.current);
    if (durationMs === 0) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: durationMs, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  }, [itemKey, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
