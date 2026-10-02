import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const catalogs=Object.fromEntries(['en','ru','uk','es'].map(locale=>[locale,require(`./i18n/${locale}.json`)]));
export function translate(locale,key,values={}) {
 if(!catalogs[locale])throw new Error('Use --locale en, ru, uk or es');
 return (catalogs[locale][key]??catalogs.en[key]??key).replace(/\{([^}]+)\}/g,(_,name)=>String(values[name]??''));
}
