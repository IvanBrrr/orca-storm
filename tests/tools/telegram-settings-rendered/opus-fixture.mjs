function page(sequence, flags, granule, packets) {
  const header = Buffer.alloc(27 + packets.length)
  header.write('OggS')
  header[5] = flags
  header.writeBigUInt64LE(BigInt(granule), 6)
  header.writeUInt32LE(0x4f524341, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = packets.length
  packets.forEach((packet, index) => {
    header[27 + index] = packet.length
  })
  const data = Buffer.concat([header, ...packets])
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 24
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)
    }
  }
  data.writeUInt32LE(crc >>> 0, 22)
  return data
}

// One second of Opus silence in an Ogg container (RFC 7845), without a microphone or encoder.
export function oggOpusSilence() {
  const head = Buffer.alloc(19)
  head.write('OpusHead')
  head[8] = 1
  head[9] = 1
  head.writeUInt32LE(48000, 12)
  const tags = Buffer.alloc(16)
  tags.write('OpusTags')
  return Buffer.concat([
    page(0, 2, 0, [head]),
    page(1, 0, 0, [tags]),
    page(
      2,
      4,
      48000,
      Array.from({ length: 50 }, () => Buffer.from([0xf8, 0xff, 0xfe]))
    )
  ])
}
