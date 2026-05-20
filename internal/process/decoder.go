package process

import "unicode/utf8"

// SmartDecoder handles streaming UTF-8 decoding, correctly handling
// multi-byte rune sequences that may be split across chunk boundaries.
// Invalid bytes are replaced with U+FFFD.
type SmartDecoder struct {
	remainder []byte
}

// Decode processes a chunk and returns decoded text.
// Incomplete multi-byte sequences at the end are saved for the next call.
func (d *SmartDecoder) Decode(chunk []byte) string {
	if len(chunk) == 0 {
		return ""
	}

	buf := append(d.remainder, chunk...)
	d.remainder = nil

	validEnd := len(buf)
	for validEnd > 0 {
		r, size := utf8.DecodeLastRune(buf[:validEnd])
		if r == utf8.RuneError && size <= 1 {
			validEnd--
			continue
		}
		break
	}

	if validEnd < len(buf) {
		remaining := buf[validEnd:]
		if len(remaining) < utf8.UTFMax && remaining[0]&0xC0 == 0xC0 {
			d.remainder = make([]byte, len(remaining))
			copy(d.remainder, remaining)
			return string(buf[:validEnd])
		}
	}

	return string(buf[:validEnd])
}

// Flush returns any remaining buffered bytes, replacing invalid sequences.
func (d *SmartDecoder) Flush() string {
	if len(d.remainder) == 0 {
		return ""
	}
	result := string(d.remainder)
	d.remainder = nil
	return result
}
