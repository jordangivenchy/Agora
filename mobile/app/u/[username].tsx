/* Someone's page: /u/username, from an author's name anywhere. */
import { useLocalSearchParams } from "expo-router";
import { ProfileScreen } from "../../src/profileScreen";

export default function UserScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <ProfileScreen key={username} username={username} />;
}
