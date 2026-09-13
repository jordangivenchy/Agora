/* Your own page: the profile as anyone sees it, plus the menu with
   Edit profile, Settings and Sign out. A guest gets the way in. */
import { View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../src/session";
import { useMe } from "../src/me";
import { ProfileScreen } from "../src/profileScreen";
import { openWeb } from "../src/web";
import { Button, Screen, Spinner, Sub, Title } from "../src/ui";

export default function You() {
  const { session, signOut } = useSession();
  const me = useMe();
  if (!session) {
    return (
      <Screen>
        <View style={{ paddingTop: 24 }}>
          <Title>Listening as a guest</Title>
          <Sub>You can listen to any public room. Sign in to raise a hand, speak, or follow people.</Sub>
          <Button onPress={() => router.replace("/sign-in")}>Sign in</Button>
        </View>
      </Screen>
    );
  }
  if (!me?.username) return <Spinner />;
  return (
    <ProfileScreen
      username={me.username}
      menu={[
        { label: "Settings", onPress: () => openWeb("/settings") },
        ...(__DEV__ ? [{ label: "Stage design (development only)", onPress: () => router.push("/dev/stage") }] : []),
        { label: "Sign out", danger: true, onPress: () => void signOut().then(() => router.replace("/sign-in")) },
      ]}
    />
  );
}

