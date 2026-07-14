<script>
  import { windowDrag } from '../../lib/windowDrag.js'
</script>

<!--
  Keeps the window draggable while a modal is open. A `fixed inset-0` backdrop
  covers the header (the app's stand-in title bar), so without this the window
  can't be moved until the modal is dismissed.

  h-14 matches the `pt-14` the modals reserve, so the strip never sits over a
  dialog. It stays under the dialog in the stacking order regardless: it is a
  sibling that the dialog is rendered after.
-->
<div class="absolute inset-x-0 top-0 h-14 z-10" use:windowDrag></div>
