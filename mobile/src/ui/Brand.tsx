import { Image } from "react-native";
import lockup from "../../assets/brand/ck-logo.png";

/** The CulinAIre Kitchen lockup, the same artwork the first app shows on its sign-in screen. */
export function Brand({ size = 200 }: { size?: number }) {
  return <Image source={lockup} style={{ width: size, height: size, alignSelf: "center" }} resizeMode="contain" accessibilityLabel="CulinAIre Kitchen" />;
}
