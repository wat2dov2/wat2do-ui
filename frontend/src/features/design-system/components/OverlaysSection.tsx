"use client";

import { useState } from "react";
import { Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ChevronDown } from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function OverlaysSection() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <TooltipProvider>
      <Section
        id="overlays"
        title="Overlays"
        description="Dialogs, tooltips, and dropdown menus."
        variant="surface"
      >
        <Stack gap={6}>
          <ShowcaseBlock label="Dialog">
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm action</DialogTitle>
                  <DialogDescription>
                    Dialogs use rounded-xl surfaces with semantic background and
                    border tokens.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </ShowcaseBlock>

          <ShowcaseBlock label="Tooltip">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Campus events update daily</p>
              </TooltipContent>
            </Tooltip>
          </ShowcaseBlock>

          <ShowcaseBlock label="DropdownMenu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  Open menu
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>View profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ShowcaseBlock>
        </Stack>
      </Section>
    </TooltipProvider>
  );
}
