/** The screens, and what each one needs to be told. */
export type RootStackParamList = {
  Home: undefined;
  Route: { routeId: string };
  Roadbook: { routeId: string };
  /** `mode` says where positions come from, and so whether the ride survives a locked screen. */
  Ride: { routeId: string; mode?: "background" | "foreground" | "preview" };
  /** With no id, shows the ride that just ended. */
  Summary: { rideId?: string };
  Rides: undefined;
  Settings: undefined;
};
