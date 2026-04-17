export interface Position {
  lat: number;
  lng: number;
  accuracy: number;    // meters
  heading: number | null; // degrees, null if unavailable
  speed: number | null;   // m/s, null if unavailable
}

type PositionCallback = (pos: Position) => void;
type ErrorCallback = (err: string) => void;

export class GPS {
  private watchId: number | null = null;
  private onPosition: PositionCallback;
  private onError: ErrorCallback;
  private lastPosition: Position | null = null;

  constructor(onPosition: PositionCallback, onError: ErrorCallback) {
    this.onPosition = onPosition;
    this.onError = onError;
  }

  start() {
    if (!navigator.geolocation) {
      this.onError('Geolocation not supported');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        };
        this.onPosition(this.lastPosition);
      },
      (err) => {
        this.onError(`GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  get current(): Position | null {
    return this.lastPosition;
  }
}
