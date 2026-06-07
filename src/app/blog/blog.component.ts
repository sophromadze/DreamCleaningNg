import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

/**
 * Placeholder for the upcoming Blog section. Not yet linked from the header
 * (the menu item is intentionally unclickable) and not yet routed — wire up a
 * route and enable the menu link once blog content is ready.
 */
@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './blog.component.html',
  styleUrl: './blog.component.scss'
})
export class BlogComponent {}
