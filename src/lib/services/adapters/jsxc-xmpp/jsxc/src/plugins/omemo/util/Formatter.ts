export default {
   toReadableKey: (key: ArrayBuffer) => {
      return (window as any).dcodeIO.ByteBuffer.wrap(key)
         .toHex(1)
         .toUpperCase()
         .match(/.{1,8}/g)
         .join(' ');
   },
};
