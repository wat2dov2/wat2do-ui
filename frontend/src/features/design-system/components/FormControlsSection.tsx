"use client";

import { useState } from "react";
import { Section, Stack } from "@/shared/layout";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/shared/ui/field";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function FormControlsSection() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);

  return (
    <Section
      id="form-controls"
      title="Form Controls"
      description="Individual field controls and accessible composition. For page structure, use Form Layout primitives."
      variant="surface"
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Input">
          <Input placeholder="Search events..." />
        </ShowcaseBlock>

        <ShowcaseBlock label="Textarea">
          <Textarea placeholder="Add event details..." rows={3} />
        </ShowcaseBlock>

        <ShowcaseBlock label="Select">
          <Select defaultValue="events">
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Choose category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="events">Events</SelectItem>
              <SelectItem value="clubs">Clubs</SelectItem>
              <SelectItem value="career">Career</SelectItem>
            </SelectContent>
          </Select>
        </ShowcaseBlock>

        <ShowcaseBlock label="Checkbox">
          <div className="flex items-center gap-3">
            <Checkbox
              id="design-system-checkbox"
              checked={termsAccepted}
              onCheckedChange={(checked) => setTermsAccepted(checked === true)}
            />
            <Label htmlFor="design-system-checkbox">
              I agree to the campus event guidelines
            </Label>
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Switch">
          <div className="flex items-center gap-3">
            <Switch
              id="design-system-switch"
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
            />
            <Label htmlFor="design-system-switch">
              {notificationsEnabled ? "Notifications on" : "Notifications off"}
            </Label>
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Field composition">
          <FieldGroup className="max-w-md">
            <Field>
              <FieldLabel htmlFor="design-system-email">Email</FieldLabel>
              <Input
                id="design-system-email"
                type="email"
                placeholder="you@uwaterloo.ca"
              />
              <FieldDescription>
                We only use this for account notifications.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}
