export class StorageService {
  static getItem<T>(key: string, defaultValue: T): T {
    if (typeof document === "undefined") {
      return defaultValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return defaultValue;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Failed to read localStorage key "${key}":`, error);
      return defaultValue;
    }
  }

  static setItem<T>(key: string, value: T): void {
    if (typeof document === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to write localStorage key "${key}":`, error);
    }
  }

  static removeItem(key: string): void {
    if (typeof document === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove localStorage key "${key}":`, error);
    }
  }

  static getSessionItem<T>(key: string, defaultValue: T): T {
    if (typeof document === "undefined") {
      return defaultValue;
    }

    try {
      const item = window.sessionStorage.getItem(key);
      if (item === null) {
        return defaultValue;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Failed to read sessionStorage key "${key}":`, error);
      return defaultValue;
    }
  }

  static setSessionItem<T>(key: string, value: T): void {
    if (typeof document === "undefined") {
      return;
    }

    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to write sessionStorage key "${key}":`, error);
    }
  }

  static removeSessionItem(key: string): void {
    if (typeof document === "undefined") {
      return;
    }

    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove sessionStorage key "${key}":`, error);
    }
  }
}
