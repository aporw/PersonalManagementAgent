import { userPreferences } from "../data/userPreferences";
import { UserPreferences } from "../types/thinking";

export function useUserPreferences(): UserPreferences {
  return userPreferences;
}
