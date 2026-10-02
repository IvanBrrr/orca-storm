import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'

export function PlaneWorkItemFilterPicker({
  label,
  allLabel,
  options,
  selected,
  onChange
}: {
  label: string
  allLabel: string
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
        >
          {selected.length ? `${label} (${selected.length})` : allLabel}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={label} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {translate('workMonitor.noFilterOptions', 'No options found')}
            </CommandEmpty>
            <CommandItem value="all" onSelect={() => onChange([])}>
              <Check className={selected.length ? 'size-3.5 opacity-0' : 'size-3.5'} />
              {allLabel}
            </CommandItem>
            {options
              .filter((option) =>
                option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())
              )
              .map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() =>
                    onChange(
                      selected.includes(option.id)
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id]
                    )
                  }
                >
                  <Check
                    className={selected.includes(option.id) ? 'size-3.5' : 'size-3.5 opacity-0'}
                  />
                  {option.label}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
