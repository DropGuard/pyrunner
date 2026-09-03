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
//
// Unlike the previous implementation, which walked backwards from the end of
// the buffer and silently dropped any tail bytes it could not prove were a
// cacheable multi-byte prefix (e.g. 4+ consecutive invalid bytes vanished
// entirely), this implementation walks forward and guarantees every input
// byte is accounted for: valid runes pass through unchanged, single invalid
// bytes become U+FFFD, and only a genuine incomplete multi-byte prefix is
// held back for the next chunk.
func (d *SmartDecoder) Decode(chunk []byte) string {
	if len(chunk) == 0 {
		return ""
	}

	buf := append(d.remainder, chunk...)
	d.remainder = nil

	out := make([]byte, 0, len(buf))
	for len(buf) > 0 {
		if utf8.FullRune(buf) {
			_, size := utf8.DecodeRune(buf)
			out = append(out, buf[:size]...)
			buf = buf[size:]
			continue
		}
		// The buffer ends in the middle of a multi-byte sequence that the
		// next chunk may complete. Cache just that prefix.
		if isUTF8Prefix(buf) {
			d.remainder = make([]byte, len(buf))
			copy(d.remainder, buf)
			break
		}
		// Invalid byte (or an invalid sequence start that is not a prefix):
		// replace this byte with U+FFFD and keep going so nothing is dropped.
		out = utf8.AppendRune(out, utf8.RuneError)
		buf = buf[1:]
	}

	return string(out)
}

// Flush returns any remaining buffered bytes, replacing invalid sequences.
func (d *SmartDecoder) Flush() string {
	if len(d.remainder) == 0 {
		return ""
	}
	out := make([]byte, 0, len(d.remainder))
	for i := 0; i < len(d.remainder); i++ {
		if d.remainder[i] < utf8.RuneSelf {
			out = append(out, d.remainder[i])
			continue
		}
		out = utf8.AppendRune(out, utf8.RuneError)
	}
	d.remainder = nil
	return string(out)
}

// isUTF8Prefix reports whether b looks like the truncated prefix of a
// multi-byte UTF-8 encoding: a lead byte plus only some of its expected
// continuation bytes. C0/C1 (overlong) and F5+ (out of range) lead bytes
// are rejected because they can never form a valid sequence.
func isUTF8Prefix(b []byte) bool {
	if len(b) == 0 || len(b) >= utf8.UTFMax {
		return false
	}
	lead := b[0]
	var need int
	switch {
	case lead >= 0xF0:
		need = 4
	case lead >= 0xE0:
		need = 3
	case lead >= 0xC2:
		need = 2
	default:
		return false
	}
	if len(b) >= need {
		return false
	}
	for _, c := range b[1:] {
		if c&0xC0 != 0x80 {
			return false
		}
	}
	return true
}
