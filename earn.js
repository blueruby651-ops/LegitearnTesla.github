
/* LegitEarn Earn & Rewards — page interactions only.
   This file does not collect money, create deposits, or promise returns. */

(() => {
    'use strict';

    const programme = document.querySelector('#programme');
    const amount = document.querySelector('#amount');
    const form = document.querySelector('#participationForm');
    const feedback = document.querySelector('#formFeedback');
    const toast = document.querySelector('#earnToast');

    const plans = {
        starter: {
            value: 'starter',
            amount: 1000,
            label: 'Starter Programme'
        },

        standard: {
            value: 'standard',
            amount: 5000,
            label: 'Standard Programme'
        },

        premium: {
            value: 'premium',
            amount: 10000,
            label: 'Premium Programme'
        }
    };

    let toastTimer;

    function notify(message) {
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');

        window.clearTimeout(toastTimer);

        toastTimer = window.setTimeout(() => {
            toast.classList.remove('show');
        }, 3600);
    }

    function choosePlan(key) {
        const selected = plans[key];

        if (!selected || !programme || !amount) return;

        programme.value = selected.value;
        amount.value = selected.amount;

        feedback.textContent =
            `${selected.label} selected. Review the programme information below.`;

        document.querySelector('#participationForm')
            ?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

        amount.dispatchEvent(
            new Event('change', {
                bubbles: true
            })
        );
    }

    // PROGRAMME BUTTONS

    document.querySelectorAll('[data-plan]').forEach(button => {

        button.addEventListener('click', () => {
            choosePlan(button.dataset.plan);
        });

    });

    // PROGRAMME SELECTOR

    programme?.addEventListener('change', () => {

        const selected = plans[programme.value];

        if (selected && amount) {
            amount.value = selected.amount;
        }

        if (feedback) {
            feedback.textContent = '';
        }

    });

    // AMOUNT INPUT

    amount?.addEventListener('input', () => {

        if (
            programme &&
            amount.value !== String(
                plans[programme.value]?.amount ?? ''
            )
        ) {
            programme.value = '';
        }

        if (feedback) {
            feedback.textContent = '';
        }

    });

    // FORM SUBMISSION

    form?.addEventListener('submit', event => {

        event.preventDefault();

        if (
            !programme?.value ||
            !amount?.value ||
            Number(amount.value) < 1000
        ) {

            feedback.textContent =
                'Please select a programme and enter a valid amount of at least ₦1,000.';

            notify('Please complete the programme fields first.');

            return;
        }

        const selected = plans[programme.value];

        if (
            !selected ||
            Number(amount.value) !== selected.amount
        ) {

            feedback.textContent =
                'Please choose one of the listed programme options so its terms can be reviewed accurately.';

            return;
        }

        feedback.textContent =
            'Selection recorded on this page only. No payment has been taken and no reward or return is guaranteed. Review the published terms before making any financial decision.';

        notify(
            'Programme details are ready for review. No payment has been processed.'
        );

    });

})();
