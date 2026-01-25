import React, { useState, useMemo, useEffect, useRef, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Search, Edit, Trash2, Calendar, MapPin, Tag, X, ArrowLeft, AlertTriangle, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { EventDetailsModal } from "./EventDetailsModal";
import type { Event } from "@/types";
import { getReportedEvents } from "@/data/adminData";

interface AdminEventsPageProps {
  events: Event[];
  onEditEvent: (event: Event) => void;
  onDeleteEvent: (eventId: number) => void;
  onBack: () => void;
  onCreateEvent?: () => void;
}

export function AdminEventsPage({
  events,
  onEditEvent,
  onDeleteEvent,
  onBack,
  onCreateEvent,
}: AdminEventsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [showReportedOnly, setShowReportedOnly] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const prevFiltersRef = useRef({ searchQuery, selectedCategory, showReportedOnly });

  // Get eventId from URL
  const eventIdParam = searchParams.get("eventId");
  const selectedEvent = useMemo(() => {
    if (eventIdParam) {
      const eventId = parseInt(eventIdParam, 10);
      if (!isNaN(eventId)) {
        return events.find((e) => e.id === eventId) || null;
      }
    }
    return null;
  }, [eventIdParam, events]);

  // Get reported events
  const reportedEvents = useMemo(() => {
    return getReportedEvents().filter((r) => r.status === "pending");
  }, []);

  // Check URL parameters on mount for highlighting
  useEffect(() => {
    if (eventIdParam) {
      const eventId = parseInt(eventIdParam, 10);
      if (!isNaN(eventId)) {
        // Use requestAnimationFrame to avoid setState in effect warning
        requestAnimationFrame(() => {
          setHighlightedEventId(eventId);
          // Scroll to the event after a short delay
          setTimeout(() => {
            const element = document.getElementById(`event-${eventId}`);
            if (element) {
              element.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 100);
        });
      }
    }
  }, [eventIdParam]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    events.forEach((event) => cats.add(event.category));
    return Array.from(cats).sort();
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(
        (event) =>
          event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          event.organization.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter((event) => event.category === selectedCategory);
    }

    // Filter by reported events
    if (showReportedOnly) {
      const reportedIds = new Set(reportedEvents.map((r) => r.eventId));
      filtered = filtered.filter((event) => reportedIds.has(event.id));
    }

    return filtered;
  }, [events, searchQuery, selectedCategory, showReportedOnly, reportedEvents]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (
      prevFiltersRef.current.searchQuery !== searchQuery ||
      prevFiltersRef.current.selectedCategory !== selectedCategory ||
      prevFiltersRef.current.showReportedOnly !== showReportedOnly
    ) {
      prevFiltersRef.current = { searchQuery, selectedCategory, showReportedOnly };
      startTransition(() => {
        setCurrentPage(1);
      });
    }
  }, [searchQuery, selectedCategory, showReportedOnly]);

  // Pagination
  const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
  const paginatedEvents = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredEvents.slice(startIndex, endIndex);
  }, [filteredEvents, currentPage]);

  const handleDelete = (eventId: number) => {
    onDeleteEvent(eventId);
    setDeleteConfirmId(null);
  };

  const isEventReported = (eventId: number) => {
    return reportedEvents.some((r) => r.eventId === eventId);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Calendar className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("admin.manageEvents")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("admin.manageEventsDesc")}
            </p>
          </div>
        </div>
        {onCreateEvent && (
          <Button onClick={onCreateEvent}>
            <Plus className="w-4 h-4 mr-2" />
            {t("events.createEvent")}
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            type="text"
            placeholder={t("admin.searchEvents")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select
          value={selectedCategory || undefined}
          onValueChange={(value) => setSelectedCategory(value || "")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("admin.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={showReportedOnly ? "default" : "outline"}
          onClick={() => setShowReportedOnly(!showReportedOnly)}
          className="flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4" />
          {t("admin.reportedOnly")}
        </Button>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <span className="font-bold text-xl text-gray-900">
          {filteredEvents.length}{" "}
          {filteredEvents.length === 1 ? t("common.event") : t("common.events")}
        </span>
      </div>

      {/* Events Table */}
      {filteredEvents.length > 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.eventTitle")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.organization")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.date")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.location")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.category")}
                </TableHead>
                <TableHead className="text-xs font-semibold text-gray-900">
                  {t("events.status")}
                </TableHead>
                <TableHead className="text-right text-xs font-semibold text-gray-900">
                  {t("admin.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedEvents.map((event) => {
                const isReported = isEventReported(event.id);
                const isHighlighted = highlightedEventId === event.id;
                return (
                  <TableRow
                    key={event.id}
                    id={`event-${event.id}`}
                    className={`cursor-pointer hover:bg-muted/50 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set("eventId", event.id.toString());
                      setSearchParams(newParams);
                    }}
                  >
                    <TableCell>
                      <div className="font-medium text-sm text-gray-900">
                        {event.title}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {event.organization}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{event.date}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="max-w-[150px] truncate">
                          {event.location}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {event.category}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isReported ? (
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-error" />
                          <span className="text-xs text-error font-medium">
                            Reported
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Live
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditEvent(event);
                          }}
                          title={t("admin.editEvent")}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(event.id);
                          }}
                          title={t("admin.deleteEvent")}
                          className="hover:bg-error/10 hover:text-error"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Event Details Modal */}
      <EventDetailsModal
        event={selectedEvent}
        onClose={() => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete("eventId");
          setSearchParams(newParams);
        }}
        allEvents={events}
      />

      {/* Pagination */}
      {filteredEvents.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {t("admin.showing")} {(currentPage - 1) * ITEMS_PER_PAGE + 1} {t("admin.to")}{" "}
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredEvents.length)} {t("admin.of")}{" "}
            {filteredEvents.length} {filteredEvents.length === 1 ? t("common.event") : t("common.events")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              {t("admin.previous")}
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="w-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              {t("admin.next")}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {filteredEvents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No events found
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No events match your current filters.
          </p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this event? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirmId && handleDelete(deleteConfirmId)
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
