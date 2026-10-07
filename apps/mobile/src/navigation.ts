/** The screens, and what each one needs to be told. */
export type RootStackParamList = {
  Routes: undefined;
  RoutePreview: { routeId: string };
  /** `mode` says whether the ride survives the screen locking. */
  Ride: { routeId: string; mode?: "background" | "foreground" };
  Settings: undefined;
  RideLogs: undefined;
};
