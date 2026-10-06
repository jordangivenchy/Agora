/* Trending as a page of its own, for a link that asks for it. In the
   app it lives in the Feed tab, beside "Your feed" ((tabs)/feed.tsx);
   this is the same list under its own title. */
import { Text, View } from "react-native";
import { TrendingList } from "../src/trendingList";
import { colors, fonts } from "../src/theme";

export default function Trending() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TrendingList
        bottomPad={40}
        top={<Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 36, letterSpacing: -0.3, marginTop: 8 }}>Trending</Text>}
      />
    </View>
  );
}
