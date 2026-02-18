const _randomBuf = new Uint32Array(1);
export function secureRandom() {
  crypto.getRandomValues(_randomBuf);
  return _randomBuf[0] / (0xFFFFFFFF + 1);
}
