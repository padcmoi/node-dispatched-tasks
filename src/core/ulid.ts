import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number) {
  let str = "";
  let n = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = n % 32;
    str = ENCODING.charAt(mod) + str;
    n = Math.floor(n / 32);
  }
  return str;
}

function encodeRandom() {
  const bytes = randomBytes(RANDOM_LEN);
  let str = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING.charAt(bytes[i] % 32);
  }
  return str;
}

export function ulid(now = Date.now()) {
  return encodeTime(now) + encodeRandom();
}

export function isUlid(value: string) {
  if (value.length !== TIME_LEN + RANDOM_LEN) return false;
  for (let i = 0; i < value.length; i++) {
    if (ENCODING.indexOf(value.charAt(i)) === -1) return false;
  }
  return true;
}
