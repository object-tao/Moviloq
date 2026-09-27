import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { bookingCountries } from "../../shared/locations";
import { defaultSite, defaultParameters, type PublicSettings } from "../../shared/settings";

const defaults: PublicSettings = {site:defaultSite,parameters:defaultParameters,countries:[...bookingCountries]};
const SettingsContext = createContext({ ...defaults, ready:false, failed:false });
export function SettingsProvider({children}:{children:ReactNode}) {
  const [state,setState]=useState({...defaults,ready:false,failed:false});
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/settings",{signal:controller.signal,cache:"no-store"}).then(async response=>{
      if(!response.ok)throw Error("SETTINGS_UNAVAILABLE");
      const settings=await response.json() as PublicSettings;
      if(!controller.signal.aborted)setState({...settings,ready:true,failed:false});
    }).catch(()=>{if(!controller.signal.aborted)setState({...defaults,ready:false,failed:true});});
    return ()=>controller.abort();
  },[]);
  return <SettingsContext.Provider value={state}>{children}</SettingsContext.Provider>;
}
export function useSettings(){return useContext(SettingsContext);}
