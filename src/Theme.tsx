import { createContext, useContext } from "react";
import { themeFor, type WheelVariant } from "../shared/variant";
export const VariantContext = createContext<WheelVariant>("beer");
/** Koekrad rounds: the word from `/koekrad <titel>`, shown as plain text. */
export const RoundTitleContext = createContext<string | undefined>(undefined);
export function useTheme() {
  const variant = useContext(VariantContext);
  const theme = themeFor(variant, useContext(RoundTitleContext));
  return {
    ...theme,
    variant,
    haler: theme.drink + "haler",
  };
}
