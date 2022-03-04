import { REGEX } from '../CONST';

export default class Location {
   public static getCurrentLocation(): Promise<{
      coords: { latitude: number; longitude: number; accuracy: number };
   }> {
      return new Promise((resolve, reject) => {
         navigator.geolocation.getCurrentPosition(
            position => resolve(position),
            error => reject(error)
         );
      });
   }

   public static async getCurrentLocationAsGeoUri(): Promise<string> {
      const {coords} = await Location.getCurrentLocation();

      return `geo:${coords.latitude},${coords.longitude};u=${coords.accuracy}`;
   }

   public static getCurrentLocationAsLink(zoom: number = 16) {
      return Location.getCurrentLocation().then(({ coords }) => {
         return Location.locationToLink(coords.latitude, coords.longitude, zoom);
      });
   }

   public static locationToLink(latitude: number, longitude: number, zoom: number = 16) {
      return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=${zoom}`;
   }

   public static parseGeoUri(uri: string) {
      const matches = uri.match(new RegExp(REGEX.GEOURI, ''));
      const latitude = matches[1] && parseFloat(matches[1]);
      const longitude = matches[2] && parseFloat(matches[2]);
      const accuracy = matches[3] && parseFloat(matches[3]);

      return {
         latitude,
         longitude,
         accuracy,
      };
   }

   public static ddToDms(latitude: number, longitude: number): string {
      const latDms = Location.decimalToDms(latitude);
      const lonDms = Location.decimalToDms(longitude);
      const latPostfix = latitude > 0 ? 'N' : 'S';
      const lonPostfix = longitude > 0 ? 'E' : 'W';

      return latDms + latPostfix + ' ' + lonDms + lonPostfix;
   }

   private static decimalToDms(deg: number): string {
      let d = Math.floor(deg);
      const minFloat = (deg - d) * 60;
      let m = Math.floor(minFloat);
      const secFloat = (minFloat - m) * 60;
      let s = Math.round(secFloat * 10) / 10;

      if (s === 60) {
         m++;
         s = 0;
      }

      if (m === 60) {
         d++;
         m = 0;
      }

      return `${d}°${m}'${s}"`;
   }
}
