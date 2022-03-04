import Log from '../../util/Log';

const namespaces = {};

export function register(name: string, value: string): void {
   namespaces[name] = value;
}

export function get(name: string) {
   const value = Strophe.NS[name] || namespaces[name];

   if (!value) {
      Log.warn('Can not resolve requested namespace ' + name);
   }

   return value;
}

export function getFilter(name: string, tagName: string = '') {
   return tagName + '[xmlns="' + get(name) + '"]';
}
