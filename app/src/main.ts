import { mount } from 'svelte'
import './app.css'
import Shell from './desktop/Shell.svelte'

export default mount(Shell, { target: document.getElementById('app')! })
