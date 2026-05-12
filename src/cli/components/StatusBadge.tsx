import { Text } from "ink";

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Text color="green">● Scheduler is active</Text>
  ) : (
    <Text color="red">
      ○ Scheduler is offline (Run &apos;pyrunner install&apos; to fix or &apos;pyrunner start&apos;
      to run manually)
    </Text>
  );
}
