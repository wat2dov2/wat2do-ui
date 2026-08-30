"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  FormActions,
  FormGrid,
  FormLayout,
  FormSection,
  Section,
} from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

const eventFormSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  organization: z.string().min(1, "Organization is required"),
  category: z.string().min(1, "Choose a category"),
  description: z.string().optional(),
});

type EventFormValues = z.infer<typeof eventFormSchema>;

export function FormLayoutSection() {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      name: "",
      organization: "",
      category: "",
      description: "",
    },
  });

  return (
    <Section
      id="form-layout"
      title="Form Layout"
      description="Compose shadcn field controls with small layout primitives. Controls handle labels and errors; layout handles width, columns, and spacing."
      variant="surface"
    >
      <FormLayout
        onSubmit={handleSubmit((values) => {
          console.log("Design system form submit:", values);
        })}
      >
        <FormSection
          title="Event details"
          description="Basic information about your event."
        >
          <FormGrid>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="design-system-event-name">Event name</FieldLabel>
              <Input
                id="design-system-event-name"
                placeholder="Campus welcome mixer"
                aria-invalid={Boolean(errors.name)}
                {...register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={Boolean(errors.organization)}>
              <FieldLabel htmlFor="design-system-organization">
                Organization
              </FieldLabel>
              <Input
                id="design-system-organization"
                placeholder="Waterloo CS Club"
                aria-invalid={Boolean(errors.organization)}
                {...register("organization")}
              />
              <FieldError errors={[errors.organization]} />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection
          title="Additional details"
          description="Optional context to help students decide."
        >
          <FormGrid columns={1}>
            <Field data-invalid={Boolean(errors.category)}>
              <FieldLabel htmlFor="design-system-category">Category</FieldLabel>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="design-system-category"
                      className="w-full"
                      aria-invalid={Boolean(errors.category)}
                    >
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="social">Social</SelectItem>
                      <SelectItem value="career">Career</SelectItem>
                      <SelectItem value="clubs">Clubs</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[errors.category]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="design-system-description">
                Description
              </FieldLabel>
              <Textarea
                id="design-system-description"
                placeholder="What should students know before they go?"
                rows={3}
                {...register("description")}
              />
              <FieldDescription>
                Shown on the event page. Keep it short and scannable.
              </FieldDescription>
            </Field>
          </FormGrid>
        </FormSection>

        <FormActions>
          <Button type="button" variant="outline">
            Cancel
          </Button>
          <Button type="submit">Create event</Button>
        </FormActions>
      </FormLayout>
    </Section>
  );
}
