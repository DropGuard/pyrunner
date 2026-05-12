import { Text } from "ink";

export function SuccessMsg({ message }: { message: string }) {
  return <Text color="green">[OK] {message}</Text>;
}
