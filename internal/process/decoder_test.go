package process

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDecoderMultiByteChunked(t *testing.T) {
	chars := []byte{0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD} // "你好"

	d := &SmartDecoder{}
	part1 := d.Decode(chars[:2]) // incomplete first char
	part2 := d.Decode(chars[2:]) // rest

	assert.Empty(t, part1, "part1 should be empty")
	assert.Equal(t, "你好", part2)
}

func TestDecoderMultipleChunks(t *testing.T) {
	hello := []byte("Hello ")
	chars := []byte{0xE4, 0xBD, 0xA0, 0xE5, 0xA5, 0xBD} // "你好"
	world := []byte(" World")

	d := &SmartDecoder{}
	r1 := d.Decode(append(hello, chars[:3]...))
	r2 := d.Decode(append(chars[3:], world...))

	assert.Equal(t, "Hello 你", r1)
	assert.Equal(t, "好 World", r2)
}

func TestDecoderFlush(t *testing.T) {
	d := &SmartDecoder{}
	d.Decode([]byte{0xE4, 0xBD}) // incomplete "你", saved as remainder
	result := d.Flush()
	assert.NotEmpty(t, result, "expected replacement characters on flush")
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

	assert.Equal(t, input, got)
}
