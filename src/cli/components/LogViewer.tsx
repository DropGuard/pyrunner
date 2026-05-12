import { Box, Text } from "ink";

function renderLines(lines: string[]) {
  return lines.map((line, i) => {
    const key = `${i}-${line.slice(0, 32)}`;
    if (line.includes("--- RUN STARTED AT")) {
      return (
        <Text key={key} color="green" bold>
          {line}
        </Text>
      );
    }
    if (line.includes("--- RUN FINISHED AT")) {
      return (
        <Text key={key} color="blue" bold>
          {line}
        </Text>
      );
    }
    if (line.includes("ERROR")) {
      return (
        <Text key={key} color="red">
          {line}
        </Text>
      );
    }
    return <Text key={key}>{line}</Text>;
  });
}

export function LogViewer({ taskName, content }: { taskName: string; content: string }) {
  const lines = content.split("\n");

  return (
    <Box flexDirection="column">
      <Text color="cyan">--- [{taskName}] ---</Text>
      {lines.length === 0 || (lines.length === 1 && lines[0] === "") ? (
        <Text dimColor>(No logs found)</Text>
      ) : (
        renderLines(lines)
      )}
    </Box>
  );
}
