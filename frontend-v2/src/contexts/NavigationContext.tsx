/**
 * Navigation Context
 * Provides navigation helpers to eliminate prop drilling
 */

import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface NavigationContextValue {
  navigate: ReturnType<typeof useNavigate>;
  navigateToAdmin: (page?: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const navigate = useNavigate();

  const navigateToAdmin = (page?: string) => {
    if (page) {
      navigate(`/admin/${page}`);
    } else {
      navigate("/admin");
    }
  };

  const value: NavigationContextValue = {
    navigate,
    navigateToAdmin,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return context;
}
