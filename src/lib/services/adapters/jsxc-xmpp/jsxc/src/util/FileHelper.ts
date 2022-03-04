import Utils from './Utils';

export default class FileHelper {
   public static getDataURLFromFile(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
         const reader = new FileReader();

         reader.onload = () => {
            resolve(reader.result as string);
         };

         reader.onerror = reject;

         reader.readAsDataURL(file);
      });
   }

   public static getFileSizeFromBase64(data: string): number {
      const base64 = data.replace(/^.+;base64,/, '');
      const buffer = Utils.base64ToArrayBuffer(base64);

      return buffer.byteLength;
   }
}
