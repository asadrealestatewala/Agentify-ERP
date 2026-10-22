import { createContext, useContext } from 'react';
export const CountryCtx = createContext(null);
export const useCountry = () => useContext(CountryCtx);
