import { IContact } from './Contact.interface';
import Translation from './util/Translation';
import Client from './Client';
import * as CONST from './CONST';
import { FUNCTION as NOTICEFUNCTION } from './Notice';
import Hash from './util/Hash';
import Log from './util/Log';
import { Presence } from './connection/AbstractConnection';

interface INotificationSettings {
   title: string;
   message: string;
   duration?: number;
   force?: boolean;
   soundFile?: string;
   loop?: boolean;
   source?: IContact;
   icon?: string;
}

enum NotificationState {
   DISABLED,
   ENABLED,
   ASK,
}
const defaultIconFile = undefined;

const NotificationAPI: any = globalThis?.Notification;

export default class Notification {
   private static popupDelay = 1000;

   private static audioObject;

   public static askForPermission() {
      /* let overlay = new Overlay();
       openConfirmDialog(Translation.t('Should_we_notify_you_'))
         .getPromise()
         .then(a => {
            //  overlay.open();

            return Notification.requestPermission();
         })
         .then(() => {
            Client.getStorage().setItem('notificationState', NotificationState.ENABLED);
         })
         .catch(err => {
            Client.getStorage().setItem('notificationState', NotificationState.DISABLED);
         })
         .then(() => {
            //  overlay.close();
         }); */
   }

   public static async notify(settings: INotificationSettings) {
      if (typeof NotificationAPI === 'undefined') {
         Log.debug('Drop notification, because notification API not available');

         return;
      }

      if (!Notification.getOption('enable')) {
         Log.debug('Drop notification, because notifications are disabled.');

         return; // notifications disabled
      }

      let state = Client.getStorage().getItem('notificationState');
      state = typeof state === 'number' ? state : NotificationState.ASK;

      if (state === NotificationState.ASK && !Notification.hasPermission()) {
         Client.getNoticeManager().addNotice({
            title: Translation.t('Notifications') + '?',
            description: Translation.t('Should_we_notify_you_'),
            fnName: NOTICEFUNCTION.notificationRequest,
         });
      }

      if (!Notification.hasPermission()) {
         Log.debug('Drop notification, because I have no permission');

         return;
      }

      if (Client.isVisible() && !settings.force) {
         Log.debug('Drop notification, because client is visible.');

         return;
      }

      settings.icon = settings.icon ??  defaultIconFile ?? '';

      if (settings.source) {
         let avatar;

         try {
            avatar = await settings.source.getAvatar();
         } catch (err) {}

         if (avatar && avatar.src) {
            settings.icon = avatar.src;
         } else {
            const hash = Hash.String(settings.source.getName());

            const hue = Math.abs(hash) % 360;
            const saturation = 90;
            const lightness = 65;

            const canvas = $('<canvas>').get(0) as HTMLCanvasElement;
            canvas.height = 100;
            canvas.width = 100;

            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'hsl(' + hue + ', ' + saturation + '%, ' + lightness + '%)';
            ctx.fillRect(0, 0, 100, 100);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'white';
            ctx.font = 'bold 50px sans-serif';
            ctx.fillText(settings.source.getName()[0].toUpperCase(), 50, 50);

            settings.icon = canvas.toDataURL('image/jpeg');
         }
      }

      settings.duration = settings.duration || Notification.getOption('popupDuration');

      setTimeout(() => {
         Notification.showPopup(settings);
      }, Notification.popupDelay);
   }

   private static showPopup(settings: INotificationSettings) {
      if (typeof settings.soundFile === 'string') {
         Notification.playSound(settings.soundFile, settings.loop, settings.force);
      }

      const popup = new NotificationAPI(settings.title, {
         body: settings.message,
         icon: settings.icon,
      });

      if (settings.duration > 0) {
         setTimeout(() => {
            popup.close();
         }, settings.duration);
      }
   }

   private static requestPermission() {
      return new Promise<void>((resolve, reject) => {
         NotificationAPI.requestPermission(status => {
            if (NotificationAPI.permission !== status) {
               NotificationAPI.permission = status;
            }

            if (Notification.hasPermission()) {
               resolve();
            } else {
               reject();
            }
         });
      });
   }

   private static hasPermission() {
      return NotificationAPI.permission === CONST.NOTIFICATION_GRANTED;
   }

   public static playSound(soundFile: string, loop?: boolean, force?: boolean) {
      if (Notification.getOption('mute') || Client.getPresenceController().getCurrentPresence() === Presence.dnd) {
         Log.debug('Sound is muted or presence is DND');

         return;
      }

      if (Client.isVisible() && !force) {
         return;
      }

      Notification.stopSound();

      const audio = new Audio(soundFile);
      audio.loop = loop || false;
      audio
         .play()
         .then(() => {
            Notification.audioObject = audio;
         })
         .catch(err => {
            Log.debug('Audio error', err);
         });
   }

   public static stopSound() {
      const audio = Notification.audioObject;

      if (typeof audio !== 'undefined' && audio !== null) {
         audio.pause();
         Notification.audioObject = null;
      }
   }

   private static getOption(name: string): any {
      const options = Client.getOption('notification') || {};

      return options[name];
   }
}
