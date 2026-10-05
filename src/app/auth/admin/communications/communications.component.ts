import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MailsComponent } from '../mails/mails.component';
import { SmsComponent } from '../sms/sms.component';

@Component({
  selector: 'app-communications',
  standalone: true,
  imports: [MailsComponent, SmsComponent],
  templateUrl: './communications.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./communications.component.scss']
})
export class CommunicationsComponent {
  activeSubTab: 'mails' | 'sms' = 'mails';

  setSubTab(tab: 'mails' | 'sms') {
    this.activeSubTab = tab;
  }
}
