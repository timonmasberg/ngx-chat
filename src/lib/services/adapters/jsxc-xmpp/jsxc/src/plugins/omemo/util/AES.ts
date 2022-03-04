import ArrayBufferUtils from '../util/ArrayBuffer';
import { AES_TAG_LENGTH, AES_KEY_LENGTH, AES_EXTRACTABLE } from './Const';

const ALGO_NAME = 'AES-GCM';

export async function decrypt(exportedAESKey: ArrayBuffer, iv: Uint8Array, data: ArrayBuffer): Promise<string> {
    const key = await window.crypto.subtle.importKey('raw', exportedAESKey, ALGO_NAME, false, ['decrypt']);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: ALGO_NAME,
            iv,
            tagLength: AES_TAG_LENGTH,
        },
        key,
        data
    );

    return ArrayBufferUtils.decode(decryptedBuffer);
}

export async function encrypt(plaintext): Promise<{ keydata: ArrayBuffer; iv: BufferSource; payload: ArrayBuffer }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await generateAESKey();
    const encrypted = await generateAESencryptedMessage(iv, key, plaintext);

    const ciphertext = encrypted.ciphertext;
    const authenticationTag = encrypted.authenticationTag;

    const keydata = await window.crypto.subtle.exportKey('raw', key as CryptoKey);

    return {
      keydata: ArrayBufferUtils.concat(keydata, authenticationTag as ArrayBuffer),
      iv,
      payload: ciphertext,
   };
}

async function generateAESKey(): Promise<CryptoKey | CryptoKeyPair> {
    const algo = {
        name: ALGO_NAME,
        length: AES_KEY_LENGTH,
    };
    const keyUsage: KeyUsage[] = ['encrypt', 'decrypt'];

    const key = await window.crypto.subtle.generateKey(algo, AES_EXTRACTABLE, keyUsage);

    return key;
}

async function generateAESencryptedMessage(
   iv,
   key,
   plaintext
): Promise<{ ciphertext: ArrayBuffer; authenticationTag: ArrayBuffer }> {
    const encryptOptions = {
        name: ALGO_NAME,
        iv,
        tagLength: AES_TAG_LENGTH,
    };
    const encodedPlaintext = ArrayBufferUtils.encode(plaintext);

    const encrypted = await window.crypto.subtle.encrypt(encryptOptions, key, encodedPlaintext);
    const ciphertextLength = encrypted.byteLength - ((128 + 7) >> 3);
    const ciphertext = encrypted.slice(0, ciphertextLength);
    const authenticationTag = encrypted.slice(ciphertextLength);

    return {
      ciphertext,
      authenticationTag,
   };
}
