import {useEffect} from "react";
import {safeProviderSession,type SafeProviderSession} from "./safe-provider-session";
export function ProviderSessionLifetime({controller=safeProviderSession}:{controller?:SafeProviderSession}){
 useEffect(()=>controller.attachLifetime(window),[controller]);return null;
}
