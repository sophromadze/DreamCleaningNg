// The services the header needs only once somebody is signed in: unpaid-order, contract and
// invoice checks for customers, and the staff badges (new orders, personal tasks, blog drafts)
// with their SignalR feed. HeaderComponent imports this module dynamically, so an anonymous
// visitor's first page never downloads them - SignalR and the admin services alone were ~100 KB
// of the initial bundle on every public page.
export { OrderService } from '../services/order.service';
export { ContractService } from '../services/contract.service';
export { InvoiceService } from '../services/invoice.service';
export { TaskService } from '../services/task.service';
export { BlogService } from '../services/blog.service';
export { SignalRService } from '../services/signalr.service';
export { NewOrderNotificationService } from '../services/new-order-notification.service';
