import { useState } from 'react'
import { StickerPolaroid } from './cork/primitives'
import {
  Accordion,
  AccordionItem,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Select,
  Separator,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
} from './components/ui'

export function ComponentGallery() {
  const [radio, setRadio] = useState('a')
  const [remember, setRemember] = useState(true)

  return (
    <div className="grid gap-8 md:grid-cols-2 md:gap-x-10 md:gap-y-12">
      <StickerPolaroid
        title="Typography"
        subtitle="Serif headings + sans UI copy"
        ball="tennis"
        pinColor="sage"
        polaroidId="typ-01"
      >
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">H1</div>
            <div className="font-serif text-3xl leading-tight text-ink">
              A calm, premium headline
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">H2</div>
            <div className="font-serif text-xl leading-snug text-ink">Soft subheading</div>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">
            Body text stays readable on cream polaroid fields.
          </p>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Card · Badge · Separator"
        subtitle="Layout primitives"
        ball="beach"
        pinColor="coral"
        polaroidId="lay-02"
        stagger
      >
        <Card className="bg-cream/90 shadow-none ring-black/8">
          <CardHeader>
            <CardTitle>Event card</CardTitle>
            <CardDescription>Soft surface, serif title, muted description.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge>New</Badge>
              <Badge variant="sage">Outdoor</Badge>
              <Badge variant="sky">Free</Badge>
              <Badge variant="outline">RSVP</Badge>
            </div>
            <Separator />
            <p className="text-sm text-gray-700">Separator divides stacked content.</p>
          </CardContent>
          <CardFooter>
            <Button size="sm">Action</Button>
          </CardFooter>
        </Card>
      </StickerPolaroid>

      <StickerPolaroid
        title="Button · Button group"
        subtitle="Primary, secondary, ghost"
        ball="basket"
        pinColor="sky"
        polaroidId="btn-03"
      >
        <div className="flex flex-col gap-4">
          <ButtonGroup aria-label="Example actions">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost" size="sm">
              Ghost
            </Button>
          </ButtonGroup>
          <p className="text-xs text-gray-500">Grouped with consistent gap + role=&quot;group&quot;.</p>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Field · Label · Input"
        subtitle="Text, textarea, select, input group"
        ball="tennis"
        pinColor="mustard"
        polaroidId="frm-04"
        stagger
      >
        <div className="space-y-4">
          <Field label="Email" htmlFor="g-email" description="We’ll never spam your inbox.">
            <Input id="g-email" type="email" placeholder="you@school.edu" autoComplete="email" />
          </Field>
          <div className="space-y-1.5">
            <Label htmlFor="g-bio">Bio</Label>
            <Textarea id="g-bio" placeholder="Short description…" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-type">Campus</Label>
            <Select
              id="g-type"
              defaultValue="main"
              options={[
                { value: 'main', label: 'Main campus' },
                { value: 'satellite', label: 'Satellite' },
                { value: 'online', label: 'Online' },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-ink">Website</span>
            <InputGroup>
              <InputGroupAddon>https://</InputGroupAddon>
              <InputGroupInput placeholder="club.example.com" aria-label="Website path" />
            </InputGroup>
          </div>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Checkbox · Radio · Switch · Slider"
        subtitle="Selection & range"
        ball="beach"
        pinColor="coral"
        polaroidId="sel-05"
      >
        <div className="space-y-5">
          <Checkbox
            checked={remember}
            onCheckedChange={setRemember}
            label="Remember this device"
          />

          <RadioGroup value={radio} onValueChange={setRadio}>
            <RadioGroupItem value="a" label="Option A — morning events" />
            <RadioGroupItem value="b" label="Option B — evening events" />
          </RadioGroup>

          <div className="flex items-center gap-3">
            <Switch defaultChecked aria-label="Enable notifications" />
            <span className="text-sm text-ink">Push notifications</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-volume">Volume</Label>
            <Slider id="g-volume" defaultValue={40} showValue max={100} />
          </div>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Progress · Spinner · Alert"
        subtitle="Status & feedback"
        ball="basket"
        pinColor="sage"
        polaroidId="fdb-06"
        stagger
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Upload</span>
              <span>65%</span>
            </div>
            <Progress value={65} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Spinner />
            <span>Loading clubs…</span>
          </div>
          <Alert variant="success">
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>Your profile was updated successfully.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Event capacity is almost full.</AlertDescription>
          </Alert>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Tabs · Accordion"
        subtitle="Disclosure patterns"
        ball="tennis"
        pinColor="sky"
        polaroidId="nav-07"
      >
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Details</TabsTrigger>
            <TabsTrigger value="two">FAQ</TabsTrigger>
          </TabsList>
          <TabsContent value="one">Tab one — schedules, location, and hosts.</TabsContent>
          <TabsContent value="two">Tab two — common questions.</TabsContent>
        </Tabs>

        <div className="mt-5">
          <Accordion>
            <AccordionItem value="1" title="What should I bring?">
              Comfortable shoes and a water bottle.
            </AccordionItem>
            <AccordionItem value="2" title="Is food included?">
              Sometimes — check the event tags.
            </AccordionItem>
          </Accordion>
        </div>
      </StickerPolaroid>

      <StickerPolaroid
        title="Dialog · Tooltip · Menu · Popover"
        subtitle="Overlays (no extra libraries)"
        ball="beach"
        pinColor="mustard"
        polaroidId="ovl-08"
        stagger
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Dialog>
            <DialogTrigger>
              <Button variant="secondary" size="sm">
                Dialog
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Dialog"
              description="Native &lt;dialog&gt; with modal focus trap from the browser."
            >
              <p className="text-sm text-gray-600">
                Use for confirmations, forms, or critical messages.
              </p>
            </DialogContent>
          </Dialog>

          <Tooltip content="I’m a tooltip">
            <Button variant="ghost" size="sm">
              Tooltip
            </Button>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="secondary" size="sm">
                Menu ▾
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => {}}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => {}}>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => {}}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger>
              <Button variant="ghost" size="sm">
                Popover
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <p className="font-medium text-ink">Popover</p>
              <p className="mt-1 text-gray-600">
                Anchored panel for hints, filters, or compact forms.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </StickerPolaroid>
    </div>
  )
}
