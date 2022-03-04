export default class HookRepository<Args extends any[] = any[]> {
   private hooks = {};

   public registerHook(eventName: string, func: (...args: Args) => void) {
      if (!this.hooks[eventName]) {
         this.hooks[eventName] = [];
      }

      this.hooks[eventName].push(func);
   }

   public removeHook(eventName: string, func: (...args: Args) => void) {
      let eventNameList = this.hooks[eventName] || [];

      if (eventNameList.indexOf(func) > -1) {
         eventNameList = $.grep(eventNameList, i => func !== i);
      }

      this.hooks[eventName] = eventNameList;
   }

   public trigger(targetEventName: string, ...args: Args) {
      const hooks = this.hooks;

      const eventNames = Object.keys(hooks);
      eventNames.forEach((eventName) => {
         if (targetEventName === eventName || targetEventName.indexOf(eventName + ':') === 0) {
            const eventNameHooks = hooks[eventName] || [];
            eventNameHooks.forEach((hook) => {
               hook.apply({}, args);
            });
         }
      });
   }
}
