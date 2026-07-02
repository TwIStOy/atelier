# Embeds Reference

## Embed Notes

```markdown
![[Note Name]]
![[Note Name#Heading]]
![[Note Name#^block-id]]
```

## Resolution Rules

Embeds and wikilinks resolve by **note filename across the whole vault**, not by
folder — `![[AI Speech CPU]]` finds that file no matter where it lives. Keep
filenames unique; if two notes share a name, Obsidian prompts to disambiguate.

- `![[Note]]` — embeds the full note.
- `![[Note#Heading]]` — embeds from that heading to the next. The heading text
  must **match exactly** (case- and punctuation-sensitive), so preserve a note's
  H1 verbatim if something embeds it by heading.
- `![[Note#^block-id]]` — embeds the block with that ID.

## Embed Images

```markdown
![[image.png]]
![[image.png|640x480]]    Width x Height
![[image.png|300]]        Width only (maintains aspect ratio)
```

## External Images

```markdown
![Alt text](https://example.com/image.png)
![Alt text|300](https://example.com/image.png)
```

## Embed Audio

```markdown
![[audio.mp3]]
![[audio.ogg]]
```

## Embed PDF

```markdown
![[document.pdf]]
![[document.pdf#page=3]]
![[document.pdf#height=400]]
```

## Embed Lists

```markdown
![[Note#^list-id]]
```

Where the list has a block ID:

```markdown
- Item 1
- Item 2
- Item 3

^list-id
```

## Embed Search Results

````markdown
```query
tag:#project status:done
```
````
