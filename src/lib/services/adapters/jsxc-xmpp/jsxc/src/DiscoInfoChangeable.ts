import DiscoInfo from './DiscoInfo';
import DiscoInfoVersion from './DiscoInfoVersion';

export default class DiscoInfoChangeable extends DiscoInfo {
   constructor(id: string) {
      super(id);
   }

   public getCapsVersion(): String {
      return DiscoInfoVersion.generate(this.getIdentities(), this.getFeatures(), []);
   }

   public addIdentity(category: string, type: string, name: string = '', lang: string = ''): boolean {
       const identities = this.getIdentities();

       for (const identity of identities) {
         if (
            identity.category === category &&
            identity.type === type &&
            identity.name === name &&
            identity.lang === lang
         ) {
            return false;
         }
      }

       identities.push({
         category,
         type,
         name,
         lang,
      });
       this.data.set('identities', identities);

       return true;
   }

   public addFeature(feature: string): boolean {
       const features = this.getFeatures();

       if (features.indexOf(feature) > -1) {
         return false;
      }

       features.push(feature);
       this.data.set('features', features);

       return true;
   }

   public removeFeature(feature: string): boolean {
       const features = this.getFeatures();
       const index = features.indexOf(feature);

       if (index > -1) {
         features.splice(index, 1);
         this.data.set('features', features);

         return true;
      }

       return false;
   }
}
