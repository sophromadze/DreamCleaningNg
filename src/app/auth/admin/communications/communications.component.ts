import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { MailsComponent } from '../mails/mails.component';
import { SmsComponent } from '../sms/sms.component';

@Component({
  selector: 'app-communications',
  standalone: true,
  imports: [MailsComponent, SmsComponent],
  templateUrl: './communications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./communications.component.scss']
})
export class CommunicationsComponent {
  readonly activeSubTab = signal<'mails' | 'sms'>('mails');

  setSubTab(tab: 'mails' | 'sms') {
    this.activeSubTab.set(tab);
  }
}
