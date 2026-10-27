const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(value: string): Uint8Array {
  let integer = 0n;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 character");
    integer = integer * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (integer > 0n) { body.unshift(Number(integer & 255n)); integer >>= 8n; }
  const zeroes = value.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([...new Array<number>(zeroes).fill(0), ...body]);
}

export function encodeBase58(bytes: Uint8Array): string {
  let integer = 0n;
  for (const byte of bytes) integer = (integer << 8n) | BigInt(byte);
  let output = "";
  while (integer > 0n) { output = ALPHABET[Number(integer % 58n)] + output; integer /= 58n; }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + output;
}
