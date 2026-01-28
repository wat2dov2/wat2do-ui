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
      // Silently fail if localStorage write fails
    }
  }

  /**
   * Remove item from localStorage
   */
  static removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // Silently fail if localStorage remove fails
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
      // Silently fail if localStorage clear fails
    }
  }
}
