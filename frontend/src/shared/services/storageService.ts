/**
 * Storage Service
 * Provides type-safe localStorage abstraction
 */

export class StorageService {
  /**
   * Get item from localStorage with type safety
   */
  static getItem<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        return defaultValue;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Failed to read localStorage key "${key}":`, error);
      return defaultValue;
    }
  }

  /**
   * Set item in localStorage
   */
  static setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to write localStorage key "${key}":`, error);
    }
  }

  /**
   * Remove item from localStorage
   */
  static removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove localStorage key "${key}":`, error);
    }
  }

  /**
   * Check if key exists in localStorage
   */
  static hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  /**
   * Clear all localStorage items
   */
  static clear(): void {
    try {
      localStorage.clear();
    } catch (error) {
      console.error("Failed to clear localStorage:", error);
    }
  }
}
