/**
 * Admin Clubs Page Hook
 * Manages state and logic for AdminClubsPage
 * Uses useReducer for complex state management
 */

import { useReducer, useMemo, useEffect, useRef, startTransition, useState } from "react";
import type { Club } from "@/shared/types";
import { loadAdminClubsData } from "@/features/admin/api/admin.api";
import { filterClubs as filterClubsSync } from "@/features/clubs";

interface AdminClubsPageState {
  searchQuery: string;
  selectedClubType: string;
  deleteConfirmId: number | null;
  showAddModal: boolean;
  editingClub: Club | null;
  currentPage: number;
}

type AdminClubsPageAction =
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_SELECTED_CLUB_TYPE"; payload: string }
  | { type: "SET_DELETE_CONFIRM_ID"; payload: number | null }
  | { type: "SET_SHOW_ADD_MODAL"; payload: boolean }
  | { type: "SET_EDITING_CLUB"; payload: Club | null }
  | { type: "SET_CURRENT_PAGE"; payload: number }
  | { type: "RESET_PAGE" }
  | { type: "OPEN_ADD_MODAL" }
  | { type: "OPEN_EDIT_MODAL"; payload: Club }
  | { type: "CLOSE_MODAL" };

const initialState: AdminClubsPageState = {
  searchQuery: "",
  selectedClubType: "",
  deleteConfirmId: null,
  showAddModal: false,
  editingClub: null,
  currentPage: 1,
};

function reducer(
  state: AdminClubsPageState,
  action: AdminClubsPageAction
): AdminClubsPageState {
  switch (action.type) {
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload };
    case "SET_SELECTED_CLUB_TYPE":
      return { ...state, selectedClubType: action.payload };
    case "SET_DELETE_CONFIRM_ID":
      return { ...state, deleteConfirmId: action.payload };
    case "SET_SHOW_ADD_MODAL":
      return { ...state, showAddModal: action.payload };
    case "SET_EDITING_CLUB":
      return { ...state, editingClub: action.payload };
    case "SET_CURRENT_PAGE":
      return { ...state, currentPage: action.payload };
    case "RESET_PAGE":
      return { ...state, currentPage: 1 };
    case "OPEN_ADD_MODAL":
      return { ...state, showAddModal: true, editingClub: null };
    case "OPEN_EDIT_MODAL":
      return { ...state, showAddModal: true, editingClub: action.payload };
    case "CLOSE_MODAL":
      return { ...state, showAddModal: false, editingClub: null };
    default:
      return state;
  }
}

interface UseAdminClubsPageOptions {
  itemsPerPage?: number;
}

export function useAdminClubsPage({ itemsPerPage = 20 }: UseAdminClubsPageOptions = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubTypes, setClubTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const prevFiltersRef = useRef({
    searchQuery: state.searchQuery,
    selectedClubType: state.selectedClubType,
  });

  // Load clubs and club types
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const { clubs: loadedClubs, clubTypes: types } =
          await loadAdminClubsData();
        setClubs(loadedClubs);
        setClubTypes(types);
      } catch (error) {
        console.error("Failed to load admin clubs data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Filter clubs synchronously — `filterClubsSync` is a pure function, so
  // running it inside an async effect would introduce an extra render
  // cycle per keystroke. A `useMemo` is both correct and cheaper.
  const filteredClubs = useMemo<Club[]>(() => {
    if (isLoading) return [];
    return filterClubsSync(clubs, {
      searchQuery: state.searchQuery,
      clubType: state.selectedClubType,
    });
  }, [clubs, state.searchQuery, state.selectedClubType, isLoading]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (
      prevFiltersRef.current.searchQuery !== state.searchQuery ||
      prevFiltersRef.current.selectedClubType !== state.selectedClubType
    ) {
      prevFiltersRef.current = {
        searchQuery: state.searchQuery,
        selectedClubType: state.selectedClubType,
      };
      startTransition(() => {
        dispatch({ type: "RESET_PAGE" });
      });
    }
  }, [state.searchQuery, state.selectedClubType]);

  // Pagination
  const totalPages = Math.ceil(filteredClubs.length / itemsPerPage);
  const paginatedClubs = useMemo(() => {
    const startIndex = (state.currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredClubs.slice(startIndex, endIndex);
  }, [filteredClubs, state.currentPage, itemsPerPage]);

  return {
    // State
    ...state,
    clubTypes,
    filteredClubs,
    paginatedClubs,
    totalPages,
    isLoading,
    // Actions
    setSearchQuery: (query: string) =>
      dispatch({ type: "SET_SEARCH_QUERY", payload: query }),
    setSelectedClubType: (type: string) =>
      dispatch({ type: "SET_SELECTED_CLUB_TYPE", payload: type }),
    setDeleteConfirmId: (id: number | null) =>
      dispatch({ type: "SET_DELETE_CONFIRM_ID", payload: id }),
    openAddModal: () => dispatch({ type: "OPEN_ADD_MODAL" }),
    openEditModal: (club: Club) => dispatch({ type: "OPEN_EDIT_MODAL", payload: club }),
    closeModal: () => dispatch({ type: "CLOSE_MODAL" }),
    setCurrentPage: (page: number) =>
      dispatch({ type: "SET_CURRENT_PAGE", payload: page }),
    refreshClubs: async () => {
      setIsLoading(true);
      try {
        const { clubs: loadedClubs, clubTypes: types } =
          await loadAdminClubsData();
        setClubs(loadedClubs);
        setClubTypes(types);
      } catch (error) {
        console.error("Failed to refresh admin clubs data:", error);
      } finally {
        setIsLoading(false);
      }
    },
  };
}
