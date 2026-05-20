package process

import (
	"testing"
)

func TestDecoderMultiByteChunked(t *testing.T) {
	chars := []byte{0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD} // "你好"

	d := &SmartDecoder{}
	part1 := d.Decode(chars[:2]) // incomplete first char
	part2 := d.Decode(chars[2:]) // rest

	if part1 != "" {
		t.Errorf("part1 should be empty, got %q", part1)
	}
	if part2 != "你好" {
		t.Errorf("part2 = %q, want '你好'", part2)
	}
}

func TestDecoderMultipleChunks(t *testing.T) {
	hello := []byte("Hello ")
	chars := []byte{0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD} // "你好"
	world := []byte(" World")

	d := &SmartDecoder{}
	r1 := d.Decode(append(hello, chars[:3]...))
	r2 := d.Decode(append(chars[3:], world...))

	if r1 != "Hello 你" {
		t.Errorf("r1 = %q", r1)
	}
	if r2 != "好 World" {
		t.Errorf("r2 = %q", r2)
	}
}

func TestDecoderFlush(t *testing.T) {
	d := &SmartDecoder{}
	d.Decode([]byte{0xE4, 0xBD}) // incomplete "你", saved as remainder
	result := d.Flush()
	if result == "" {
		t.Error("expected replacement characters on flush")
	}
}

func TestDecoderFullCJK(t *testing.T) {
	input := "床前明月光，疑是地上霜。举头望明月，低头思故乡。"
	d := &SmartDecoder{}
	data := []byte(input)

	var got string
	for i := 0; i < len(data); i += 4 {
		end := min(i+4, len(data))
		got += d.Decode(data[i:end])
	}
	got += d.Flush()

	if got != input {
		t.Errorf("got %q, want %q", got, input)
	}
}
