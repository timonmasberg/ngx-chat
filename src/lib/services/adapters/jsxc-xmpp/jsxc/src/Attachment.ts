import Log from './util/Log';
import UUID from './util/UUID';
import PersistentMap from './util/PersistentMap';
import Client from './Client';
import FileHelper from './util/FileHelper';
import ImageHelper from './util/ImageHelper';
import Utils from './util/Utils';

export type AttachmentHandler = (attachment: Attachment, active: boolean) => Promise<void>;

export default class Attachment {

   constructor(name: string, mimeType: string, data: string);
   constructor(file: File);
   // tslint:disable-next-line:unified-signatures
   constructor(uid: string);
   constructor() {
      if (arguments.length === 1 && typeof arguments[0] === 'string') {
         this.uid = arguments[0];
      }

      const storage = Client.getStorage();
      this.properties = new PersistentMap(storage, this.getUid());

      if (arguments[0] instanceof File) {
         this.file = arguments[0];

         this.properties.set({
            mimeType: this.file.type,
            name: this.file.name,
            size: this.file.size,
         });
      } else if (arguments.length === 3) {
         this.properties.set({
            mimeType: arguments[1],
            name: arguments[0],
         });

         this.data = arguments[2];
      }

      if (this.isImage() && this.file && !this.hasThumbnailData()) {
         this.generateThumbnail();
      }
   }
   private static handlers: { [key: string]: AttachmentHandler } = {};

   private data: string;

   private file: File;

   private uid: string;

   private properties: PersistentMap;

   public static registerHandler(key: string, handler: AttachmentHandler) {
      Attachment.handlers[key] = handler;
   }

   public delete() {
      this.properties.delete();
   }

   public getUid(): string {
      if (!this.uid) {
         this.uid = UUID.v4();
      }

      return this.uid;
   }

   public getData() {
      if (!this.data) {
         this.data = this.properties.get('data');
      }

      return this.data;
   }

   public setData(data: string): boolean {
      this.data = data;

      if (typeof data === 'string' && data.length < 1024) {
         this.properties.set('data', data);

         return true;
      }

      Log.warn('Data to large to store');

      return false;
   }

   public setProcessed(processed: boolean) {
      this.properties.set('processed', processed);
   }

   public isProcessed(): boolean {
      return !!this.properties.get('processed');
   }

   public getSize(): number {
      return this.properties.get('size');
   }

   public getMimeType(): string {
      return this.properties.get('mimeType');
   }

   public setThumbnailData(thumbnail: string) {
      this.properties.set('thumbnail', thumbnail);
   }

   public getThumbnailData() {
      return this.properties.get('thumbnail');
   }

   public getName() {
      return this.properties.get('name');
   }

   public getHandler() {
      const handlerKey = this.properties.get('handler');

      return handlerKey && Attachment.handlers[handlerKey];
   }

   public setHandler(key: string) {
      this.properties.set('handler', key);
   }

   public setFile(file: File) {
      this.file = file;
   }

   public getFile(): File {
      return this.file;
   }

   public isPersistent(): boolean {
      return !!this.properties.get('data');
   }

   public isImage(): boolean {
      return /^image\/(jpeg|jpg|gif|png|svg)/i.test(this.getMimeType());
   }

   public hasThumbnailData(): boolean {
      return !!this.getThumbnailData();
   }

   public hasData(): boolean {
      return !!this.getData();
   }

   public clearData() {
      this.data = null;
   }

   public getElement() {
      const type = this.getMimeType();
      const name = this.getName();
      const size = Utils.formatBytes(this.getSize());

      const wrapperElement = $('<div>');
      wrapperElement.addClass('jsxc-attachment');
      wrapperElement.addClass('jsxc-' + type.replace(/\//, '-'));
      wrapperElement.addClass('jsxc-' + type.replace(/^([^/]+)\/.*/, '$1'));

      const title = `${name} (${size})`;

      if (FileReader && this.isImage() && this.file) {
         // show image preview
         const img = $('<img alt="preview">');
         img.attr('title', title);
         // img.attr('src', jsxc.options.get('root') + '/img/loading.gif');

         FileHelper.getDataURLFromFile(this.file).then(src => {
            img.attr('src', src);
         });

         return wrapperElement.append(img);
      } else {
         return wrapperElement.text(title);
      }
   }

   public registerThumbnailHook = (hook: (thumbnail?: string) => void) => {
      this.properties.registerHook('thumbnail', hook);
   }

   public generateThumbnail(force: boolean = false): Promise<void> {
      if (typeof Image === 'undefined') {
         return Promise.resolve();
      }

      if (!this.isImage() || /^image\/svg/i.test(this.getMimeType())) {
         return Promise.resolve();
      }

      if (force || !this.hasData()) {
         if (this.file) {
            FileHelper.getDataURLFromFile(this.file).then(data => {
               this.data = data;

               this.generateThumbnail();
            });
         }

         return Promise.resolve();
      }

      return ImageHelper.scaleDown(this.data).then(thumbnailData => {
         this.properties.set('thumbnail', thumbnailData);
      });
   }
}
